"use client";

import { useEffect, useRef, useState } from "react";
import type { Arena, Side } from "@/lib/arena";

type FlowEvent = {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  quoteValue: number;
  tx: string;
};
type Trending = { symbol: string; count: number; buys: number; sells: number };
type Tick = { side: "buy" | "sell"; symbol: string; v: number; id: number };

const LIME = "#c4ff3e";
const RED = "#ff4d4d";

export default function Pit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);

  // mutable game state (refs so intervals never read stale values)
  const cursor = useRef<string | undefined>(undefined);
  const queue = useRef<FlowEvent[]>([]);
  const trending = useRef<Trending[]>([]);
  const fighters = useRef<{ left: string; right: string } | null>(null);
  const hp = useRef({ left: 100, right: 100 });
  const koLock = useRef(false);

  const [, force] = useState(0);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [round, setRound] = useState(0);
  const [koText, setKoText] = useState<string | null>(null);
  const repaint = () => force((n) => n + 1);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval>;
    let play: ReturnType<typeof setInterval>;
    let tid = 0;

    (async () => {
      const { createArena } = await import("@/lib/arena");
      if (!alive || !canvasRef.current) return;
      const arena = createArena(canvasRef.current);
      arenaRef.current = arena;

      const sideOf = (sym: string): Side | null =>
        !fighters.current ? null : sym === fighters.current.left ? "left" : sym === fighters.current.right ? "right" : null;

      const pickFighters = () => {
        const t = trending.current;
        if (t.length >= 2) {
          fighters.current = { left: t[0].symbol, right: t[1].symbol };
          hp.current = { left: 100, right: 100 };
          repaint();
        }
      };

      const pollFlow = async () => {
        try {
          const q = cursor.current ? `?since=${cursor.current}` : "";
          const res = await fetch(`/api/flow${q}`);
          const data = await res.json();
          if (!res.ok) return;
          cursor.current = data.latestBlock;
          trending.current = data.trending ?? [];
          if (!fighters.current) pickFighters();
          const active = fighters.current;
          if (active) {
            for (const e of data.events as FlowEvent[]) {
              if (e.symbol === active.left || e.symbol === active.right) queue.current.push(e);
            }
            if (queue.current.length > 48) queue.current = queue.current.slice(-48);
          }
          repaint();
        } catch {
          /* transient */
        }
      };

      const playTick = () => {
        // gentle regen keeps fights alive
        hp.current.left = Math.min(100, hp.current.left + 0.5);
        hp.current.right = Math.min(100, hp.current.right + 0.5);

        const e = queue.current.shift();
        if (e && !koLock.current) {
          const side = sideOf(e.symbol);
          if (side) {
            const norm = Math.min(e.quoteValue / 0.05, 1.4);
            if (e.side === "buy") {
              arena.strike(side, norm);
              const foe: Side = side === "left" ? "right" : "left";
              hp.current[foe] = Math.max(0, hp.current[foe] - (5 + norm * 16));
            } else {
              arena.stagger(side, norm);
              hp.current[side] = Math.max(0, hp.current[side] - (3 + norm * 6));
            }
            setTicks((prev) => [{ side: e.side, symbol: e.symbol, v: e.quoteValue, id: tid++ }, ...prev].slice(0, 9));
          }
        }

        // KO check
        if (!koLock.current && fighters.current) {
          const loser: Side | null = hp.current.left <= 0 ? "left" : hp.current.right <= 0 ? "right" : null;
          if (loser) {
            koLock.current = true;
            const winner = loser === "left" ? fighters.current.right : fighters.current.left;
            arena.ko(loser);
            setKoText(`${winner} wins`);
            setTimeout(() => {
              if (!alive) return;
              arena.reset();
              queue.current = [];
              koLock.current = false;
              setKoText(null);
              setRound((r) => r + 1);
              pickFighters(); // rematch on the freshest trending pair
            }, 1900);
          }
        }
        repaint();
      };

      await pollFlow();
      poll = setInterval(pollFlow, 2500);
      play = setInterval(playTick, 360);
    })();

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(play);
      arenaRef.current?.dispose();
    };
  }, []);

  const f = fighters.current;
  const barL = hp.current.left;
  const barR = hp.current.right;
  const statOf = (sym?: string) => trending.current.find((t) => t.symbol === sym);

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div className="hud">
        <div className="title">
          <h1>The Pit</h1>
          <div className="sub">live Robinhood Chain order flow · buys strike · sells stagger</div>
        </div>

        <div className="fighters">
          <div className="fighter">
            <div className="fname" style={{ color: LIME }}>{f?.left ?? "matching…"}</div>
            <div className="hpwrap"><div className="hp" style={{ width: `${barL}%`, background: LIME }} /></div>
            <div className="stat">
              <b className="buy">{statOf(f?.left)?.buys ?? 0} buys</b> · <b className="sell">{statOf(f?.left)?.sells ?? 0} sells</b>
            </div>
          </div>
          <div className="fighter r">
            <div className="fname" style={{ color: RED }}>{f?.right ?? "matching…"}</div>
            <div className="hpwrap"><div className="hp r" style={{ width: `${barR}%`, background: RED, marginLeft: "auto" }} /></div>
            <div className="stat">
              <b className="buy">{statOf(f?.right)?.buys ?? 0} buys</b> · <b className="sell">{statOf(f?.right)?.sells ?? 0} sells</b>
            </div>
          </div>
        </div>

        <div className={`round ${koText ? "show" : ""}`}>{koText}</div>

        <div className="ticker">
          {ticks.map((t) => (
            <span key={t.id} className="tick">
              <span className={t.side === "buy" ? "b" : "s"}>{t.side === "buy" ? "▲ buy" : "▼ sell"}</span> {t.symbol}
            </span>
          ))}
        </div>

        <div className="foot">round {round + 1} · live on Robinhood Chain · by jumpbox</div>
      </div>
    </>
  );
}
