// Pure, framework-free fight engine. Deterministic given (events, clock) so it can
// be simulated headlessly to tune balance. The UI feeds it flow events + a clock and
// renders the resulting state; the arena plays the returned effects.

export type Side = "left" | "right";

export const CFG = {
  HP_MAX: 1000,
  ROUND_MS: 75_000,
  ROUNDS_TO_WIN: 2, // best of 3
  BASE_DMG: 11,
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
  SELL_CHIP: 4, // per unit power, self chip
  POWER_MIN: 0.25,
  POWER_MAX: 4,
  ROLL_WINDOW: 24,
};

export type FighterState = {
  symbol: string;
  hp: number;
  guard: number;
  combo: number;
  comboExpiry: number;
  exposedUntil: number;
  roundsWon: number;
  sizes: number[]; // rolling recent trade sizes for normalization
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

function newFighter(symbol: string): FighterState {
  return { symbol, hp: CFG.HP_MAX, guard: CFG.GUARD_MAX, combo: 0, comboExpiry: 0, exposedUntil: 0, roundsWon: 0, sizes: [] };
}

export function createMatch(leftSym: string, rightSym: string, now: number): MatchState {
  return {
    left: newFighter(leftSym),
    right: newFighter(rightSym),
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

function powerOf(f: FighterState, size: number): number {
  f.sizes.push(size);
  if (f.sizes.length > CFG.ROLL_WINDOW) f.sizes.shift();
  const med = median(f.sizes);
  if (med <= 0) return 1;
  return Math.max(CFG.POWER_MIN, Math.min(CFG.POWER_MAX, size / med));
}

function comboMult(f: FighterState): number {
  const i = Math.min(f.combo, CFG.COMBO_STEPS.length - 1);
  return CFG.COMBO_STEPS[Math.max(0, i)];
}

/** Feed one classified flow event. Returns visual effects. Mutates state. */
export function applyFlow(
  state: MatchState,
  ev: { symbol: string; side: "buy" | "sell"; quoteValue: number },
  now: number,
): Effect[] {
  if (state.phase !== "fight") return [];
  const side: Side | null =
    ev.symbol === state.left.symbol ? "left" : ev.symbol === state.right.symbol ? "right" : null;
  if (!side) return [];

  const me = state[side];
  const foe = state[other(side)];
  const power = powerOf(me, ev.quoteValue);
  const effects: Effect[] = [];

  if (ev.side === "buy") {
    // buying me restores my guard, and I strike the opponent
    me.guard = Math.min(CFG.GUARD_MAX, me.guard + CFG.GUARD_ON_BUY * power);
    // combo
    me.combo = now < me.comboExpiry ? me.combo + 1 : 0;
    me.comboExpiry = now + CFG.COMBO_WINDOW_MS;

    // Continuous guard mitigation: full guard softens to chip, empty guard lands clean.
    // A recent sell (exposed) ignores guard entirely and can crit.
    const exposed = now < foe.exposedUntil;
    const gf = foe.guard / CFG.GUARD_MAX; // 0..1
    let landMult: number;
    let crit = false;
    if (exposed) {
      crit = me.combo >= 2 || power > 1.8;
      landMult = crit ? CFG.CRIT_MULT : CFG.CLEAN_MULT;
    } else {
      landMult = CFG.CHIP_MULT + (CFG.CLEAN_MULT - CFG.CHIP_MULT) * (1 - gf);
    }
    const dmg = CFG.BASE_DMG * power * landMult * comboMult(me);
    foe.hp = Math.max(0, foe.hp - dmg);
    const blocked = !exposed && gf >= CFG.BLOCK_AT;
    effects.push({ type: "strike", side, power, crit, blocked, combo: me.combo });
  } else {
    // selling me drains my guard and exposes me; small self chip (can't KO)
    me.guard = Math.max(0, me.guard - CFG.GUARD_ON_SELL * power);
    me.exposedUntil = now + CFG.EXPOSE_MS;
    me.combo = 0;
    me.hp = Math.max(1, me.hp - CFG.SELL_CHIP * power);
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
