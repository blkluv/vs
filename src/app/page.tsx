"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Arena, Side } from "@/lib/arena";
import { createMatch, applyFlow, tick, CFG, type MatchState } from "@/lib/fight";

type FlowEvent = { symbol: string; side: "buy" | "sell"; quoteValue: number };
type Trending = { symbol: string; count: number; buys: number; sells: number };

const LIME = "#c4ff3e";
const RED = "#ff4d4d";

function hue(sym: string) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return h;
}
const cardColor = (sym: string) => `hsl(${hue(sym)} 80% 60%)`;

export default function Pit() {
  const [match, setMatch] = useState<{ left: string; right: string } | null>(null);
  if (!match) return <Select onStart={(l, r) => setMatch({ left: l, right: r })} />;
  return <Fight left={match.left} right={match.right} onExit={() => setMatch(null)} key={`${match.left}-${match.right}`} />;
}

/* ---------------- selection screen ---------------- */

function Select({ onStart }: { onStart: (l: string, r: string) => void }) {
  const [roster, setRoster] = useState<Trending[]>([]);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/flow");
        const d = await r.json();
        if (alive && d.trending) setRoster(d.trending);
      } catch {}
    };
    load();
    const id = setInterval(load, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const toggle = (sym: string) =>
    setPicked((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : p.length < 2 ? [...p, sym] : [p[1], sym]));

  return (
    <div className="select">
      <div className="s-head">
        <h1>THE PIT</h1>
        <div className="s-sub">pick two Robinhood Chain memecoins · their live order flow does the fighting</div>
      </div>

      <div className="roster">
        {roster.length === 0 && <div className="loading">reading the trenches…</div>}
        {roster.map((t) => {
          const sel = picked.includes(t.symbol);
          const total = Math.max(1, t.buys + t.sells);
          const c = cardColor(t.symbol);
          return (
            <button key={t.symbol} className={`card ${sel ? "sel" : ""}`} onClick={() => toggle(t.symbol)} style={{ ["--c" as string]: c }}>
              <div className="emblem" style={{ background: `radial-gradient(circle at 35% 30%, ${c}, #0a0e0a 78%)` }}>
                {t.symbol.slice(0, 2).toUpperCase()}
              </div>
              <div className="c-sym">{t.symbol}</div>
              <div className="c-bar">
                <span className="c-buy" style={{ width: `${(t.buys / total) * 100}%` }} />
                <span className="c-sell" style={{ width: `${(t.sells / total) * 100}%` }} />
              </div>
              <div className="c-stat"><b className="buy">{t.buys}▲</b> <b className="sell">{t.sells}▼</b> · {t.count} trades</div>
              {sel && <div className="c-pick">{picked.indexOf(t.symbol) === 0 ? "① left" : "② right"}</div>}
            </button>
          );
        })}
      </div>

      <div className="s-foot">
        <button className="enter" disabled={picked.length < 2} onClick={() => onStart(picked[0], picked[1])}>
          {picked.length < 2 ? `pick ${2 - picked.length} more` : `⚔ ${picked[0]}  vs  ${picked[1]}`}
        </button>
        <div className="hint">no token · pure spectacle · by jumpbox</div>
      </div>
    </div>
  );
}

/* ---------------- fight screen ---------------- */

function Fight({ left, right, onExit }: { left: string; right: string; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const stateRef = useRef<MatchState | null>(null);
  const queue = useRef<FlowEvent[]>([]);
  const cursor = useRef<string | undefined>(undefined);
  const [, force] = useState(0);
  const repaint = useCallback(() => force((n) => (n + 1) % 1e6), []);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval>;
    let drain: ReturnType<typeof setInterval>;
    let ticker: ReturnType<typeof setInterval>;

    (async () => {
      const { createArena } = await import("@/lib/arena");
      if (!alive || !canvasRef.current) return;
      const arena = createArena(canvasRef.current);
      arenaRef.current = arena;
      stateRef.current = createMatch(left, right, Date.now());

      const applyEffects = (fx: ReturnType<typeof applyFlow>) => {
        for (const e of fx) {
          if (e.type === "strike") arena.strike(e.side, e.blocked ? e.power * 0.35 : e.power, e.crit);
          else if (e.type === "stagger") arena.stagger(e.side, 0.8);
          else if (e.type === "ko") arena.ko(e.loser);
        }
      };

      const pollFlow = async () => {
        try {
          const q = cursor.current ? `?since=${cursor.current}` : "";
          const res = await fetch(`/api/flow${q}`);
          const d = await res.json();
          if (!res.ok) return;
          cursor.current = d.latestBlock;
          for (const e of d.events as FlowEvent[]) {
            if (e.symbol === left || e.symbol === right) queue.current.push(e);
          }
          if (queue.current.length > 60) queue.current = queue.current.slice(-60);
        } catch {}
      };

      await pollFlow();
      poll = setInterval(pollFlow, 2500);
      drain = setInterval(() => {
        const st = stateRef.current!;
        const e = queue.current.shift();
        if (e && st.phase === "fight") applyEffects(applyFlow(st, e, Date.now()));
        repaint();
      }, 360);
      ticker = setInterval(() => {
        const st = stateRef.current!;
        applyEffects(tick(st, Date.now(), 100));
        repaint();
      }, 100);
    })();

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(drain);
      clearInterval(ticker);
      arenaRef.current?.dispose();
    };
  }, [left, right, repaint]);

  const st = stateRef.current;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / CFG.HP_MAX) * 100))}%`;
  const timeLeft = st && st.phase === "fight" ? Math.max(0, Math.ceil((st.roundEndsAt - Date.now()) / 1000)) : null;
  const pips = (won: number) => Array.from({ length: CFG.ROUNDS_TO_WIN }, (_, i) => i < won);

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div className="hud">
        <div className="title">
          <h1>{left} <span className="vs">vs</span> {right}</h1>
          <div className="sub">round {st?.round ?? 1} · {timeLeft !== null ? `${timeLeft}s` : "—"} · buys strike · sells expose</div>
        </div>

        <div className="fighters">
          <div className="fighter">
            <div className="fname" style={{ color: LIME }}>
              {left} <span className="pips">{pips(st?.left.roundsWon ?? 0).map((w, i) => <i key={i} className={w ? "on" : ""} />)}</span>
            </div>
            <div className="hpwrap"><div className="hp" style={{ width: pct(st?.left.hp ?? CFG.HP_MAX), background: LIME }} /></div>
            <div className="guardwrap"><div className="guard" style={{ width: `${st?.left.guard ?? 100}%` }} /></div>
            {(st?.left.combo ?? 0) >= 2 && <div className="combo" style={{ color: LIME }}>combo ×{st!.left.combo + 1}</div>}
          </div>
          <div className="fighter r">
            <div className="fname" style={{ color: RED }}>
              <span className="pips r">{pips(st?.right.roundsWon ?? 0).map((w, i) => <i key={i} className={w ? "on" : ""} />)}</span> {right}
            </div>
            <div className="hpwrap"><div className="hp r" style={{ width: pct(st?.right.hp ?? CFG.HP_MAX), background: RED, marginLeft: "auto" }} /></div>
            <div className="guardwrap"><div className="guard r" style={{ width: `${st?.right.guard ?? 100}%`, marginLeft: "auto" }} /></div>
            {(st?.right.combo ?? 0) >= 2 && <div className="combo r" style={{ color: RED }}>combo ×{st!.right.combo + 1}</div>}
          </div>
        </div>

        <div className={`round ${st?.banner ? "show" : ""}`}>{st?.banner}</div>

        {st?.phase === "matchEnd" && (
          <div className="endbtns">
            <button onClick={onExit}>← new match</button>
          </div>
        )}
        <div className="foot">live on Robinhood Chain · by jumpbox</div>
      </div>
    </>
  );
}
