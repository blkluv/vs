// A trash-talking ring announcer. Turns fight effects into throttled callouts
// (text ticker) and optionally yells them via the browser's speech synthesis.

export type Intensity = "low" | "mid" | "high";
export type Callout = { id: number; text: string; intensity: Intensity };

const POOLS: Record<string, { lines: string[]; intensity: Intensity }> = {
  crit: {
    intensity: "high",
    lines: ["CRITICAL! right on the chin!", "OH, he FELT that one!", "MASSIVE hit!", "BOOM! clean crit!", "that's gotta hurt!", "devastating blow!"],
  },
  bigStrike: {
    intensity: "high",
    lines: ["a WHALE just connected!", "huge buy — huge hit!", "the heavy artillery!", "he's swinging for the fences!"],
  },
  strike: {
    intensity: "mid",
    lines: ["{a} tags {b}!", "in he goes!", "keeps the pressure on {b}!", "{a} lands another!", "steady chip on {b}"],
  },
  block: {
    intensity: "low",
    lines: ["blocked!", "{b} holds the guard!", "wall of green!", "{b} shrugs it off"],
  },
  expose: {
    intensity: "high",
    lines: ["{who} is WIDE OPEN!", "sellers piling on {who}!", "{who}'s guard is GONE!", "{who} on the ropes!", "the floor drops out for {who}!"],
  },
  combo: {
    intensity: "high",
    lines: ["COMBO! times {n}!", "{a} is chaining them!", "unrelenting! {n} in a row!", "{b} can't respond!"],
  },
  ko: {
    intensity: "high",
    lines: ["{who} IS DOWN!", "KNOCKOUT! {winner} takes the round!", "it's OVER — {winner}!", "{who} hits the canvas!"],
  },
  round: {
    intensity: "high",
    lines: ["{banner}... FIGHT!", "here we go — {banner}!", "{banner}. seconds out!"],
  },
  comeback: {
    intensity: "mid",
    lines: ["{who} is hanging on!", "what a chin on {who}!", "{who} refuses to fall!"],
  },
};

function fill(t: string, v: Record<string, string | number>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
}

export class Commentator {
  private id = 0;
  private lastAt = 0;
  private last = "";
  private minGapMs = 3400; // keep it sparse — a color commentator, not play-by-play on every volley

  /** Maybe produce a callout. Only KOs and round calls bypass the gap. */
  say(now: number, kind: keyof typeof POOLS, vars: Record<string, string | number> = {}): Callout | null {
    const pool = POOLS[kind];
    if (!pool) return null;
    const alwaysFire = kind === "ko" || kind === "round";
    if (!alwaysFire && now - this.lastAt < this.minGapMs) return null;
    let text = fill(pool.lines[Math.floor((now / 137) % pool.lines.length)], vars);
    if (text === this.last) text = fill(pool.lines[Math.floor((now / 91 + 1) % pool.lines.length)], vars);
    this.last = text;
    this.lastAt = now;
    return { id: this.id++, text, intensity: pool.intensity };
  }
}

let voiceReady = false;
export function speak(text: string, intensity: Intensity, muted: boolean) {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = intensity === "high" ? 1.28 : intensity === "mid" ? 1.12 : 1.0;
    u.pitch = intensity === "high" ? 1.35 : 1.1;
    u.volume = 1;
    // let a high-intensity yell interrupt lower chatter
    if (intensity === "high") window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    voiceReady = true;
  } catch {
    /* no voice available */
  }
}
export function voiceAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
