"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Arena } from "@/lib/arena";
import { createMatch, applyFlow, tick, CFG, type MatchState } from "@/lib/fight";
import { Commentator, speak, voiceAvailable, type Callout } from "@/lib/commentator";

type FlowEvent = { symbol: string; side: "buy" | "sell"; amount: number; quoteValue: number };
type Fighter = { symbol: string; count: number; buys: number; sells: number; logo: string | null; mcap: number | null; supply: number | null };

const LIME = "#c4ff3e";
const RED = "#ff4d4d";

function hue(sym: string) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return h;
}
const cardColor = (sym: string) => `hsl(${hue(sym)} 80% 60%)`;
const fmtCap = (n: number | null) => (n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`);
const fmtAmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

function LogoBadge({ f }: { f: Fighter }) {
  const c = cardColor(f.symbol);
  return f.logo ? (
    <img className="hp-logo" src={f.logo} alt="" />
  ) : (
    <span className="hp-logo hp-logo-fb" style={{ background: `radial-gradient(circle at 35% 30%, ${c}, #0a0e0a 80%)` }}>{f.symbol.slice(0, 2).toUpperCase()}</span>
  );
}

export default function Pit() {
  const [phase, setPhase] = useState<"select" | "intro" | "fight">("select");
  const [f, setF] = useState<{ left: Fighter; right: Fighter } | null>(null);

  if (phase === "select" || !f)
    return <Select onStart={(l, r) => { setF({ left: l, right: r }); setPhase("intro"); }} />;
  if (phase === "intro")
    return <Intro left={f.left} right={f.right} onDone={() => setPhase("fight")} />;
  return <Fight left={f.left} right={f.right} onExit={() => { setF(null); setPhase("select"); }} key={`${f.left.symbol}-${f.right.symbol}`} />;
}

/* ---------------- cinematic VS intro ---------------- */

function useCountUp(target: number | null, dur = 1000, delay = 950): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null) return;
    let raf = 0;
    let start: number | undefined;
    const to = setTimeout(() => {
      const step = (ts: number) => {
        if (start === undefined) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        setV(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(to); cancelAnimationFrame(raf); };
  }, [target, dur, delay]);
  return v;
}

function TapeCard({ f, side }: { f: Fighter; side: "left" | "right" }) {
  const c = cardColor(f.symbol);
  const mcap = useCountUp(f.mcap ?? null, 1100, 1000);
  const supply = useCountUp(f.supply ?? null, 1100, 1050);
  return (
    <div className={`tcard ${side}`} style={{ ["--c" as string]: c }}>
      <div className="tglow" />
      {f.logo ? <img className="tlogo" src={f.logo} alt="" /> : <div className="tlogo tlogo-fb">{f.symbol.slice(0, 2).toUpperCase()}</div>}
      <div className="tsym">{f.symbol}</div>
      <div className="tstats">
        <div className="trow"><span>MCAP</span><b>{f.mcap == null ? "—" : fmtCap(mcap)}</b></div>
        <div className="trow"><span>SUPPLY</span><b>{f.supply == null ? "—" : fmtAmt(supply)}</b></div>
        <div className="trow"><span>FLOW</span><b><i className="buy">{f.buys}▲</i> <i className="sell">{f.sells}▼</i></b></div>
      </div>
    </div>
  );
}

function Intro({ left, right, onDone }: { left: Fighter; right: Fighter; onDone: () => void }) {
  const [end, setEnd] = useState(false);
  useEffect(() => {
    const ann = setTimeout(() => speak(`${left.symbol}... versus... ${right.symbol}`, "high", false), 700);
    const fw = setTimeout(() => setEnd(true), 2900);
    const done = setTimeout(onDone, 3650);
    return () => { clearTimeout(ann); clearTimeout(fw); clearTimeout(done); };
  }, [left, right, onDone]);

  return (
    <div className="intro" onClick={onDone}>
      <div className="intro-bg" />
      <div className="intro-flash" />
      <div className="tape">
        <TapeCard f={left} side="left" />
        <div className="vsmark">VS</div>
        <TapeCard f={right} side="right" />
      </div>
      <div className={`fightword ${end ? "show" : ""}`}>FIGHT</div>
      <div className="skiphint">click to skip</div>
    </div>
  );
}

/* ---------------- selection screen ---------------- */

const PER_PAGE = 10;

function Select({ onStart }: { onStart: (l: Fighter, r: Fighter) => void }) {
  const [roster, setRoster] = useState<Fighter[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [page, setPage] = useState(0);

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
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const toggle = (sym: string) =>
    setPicked((p) => (p.includes(sym) ? p.filter((s) => s !== sym) : p.length < 2 ? [...p, sym] : [p[1], sym]));
  const bySym = (s: string) => roster.find((t) => t.symbol === s)!;

  const pages = Math.max(1, Math.ceil(roster.length / PER_PAGE));
  const pg = Math.min(page, pages - 1);
  const visible = roster.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE);

  return (
    <div className="select">
      <div className="s-head">
        <h1>THE PIT</h1>
        <div className="s-sub">pick two Robinhood Chain memecoins · their live order flow does the fighting</div>
      </div>

      {roster.length === 0 ? (
        <div className="loading">reading the trenches…</div>
      ) : (
        <>
          <div className="mlist">
            {visible.map((t, i) => {
              const sel = picked.includes(t.symbol);
              const total = Math.max(1, t.buys + t.sells);
              const c = cardColor(t.symbol);
              const rank = pg * PER_PAGE + i + 1;
              return (
                <button key={t.symbol} className={`mrow ${sel ? "sel" : ""}`} onClick={() => toggle(t.symbol)} style={{ ["--c" as string]: c }}>
                  <span className="midx">{rank}</span>
                  {t.logo ? <img className="mlogo" src={t.logo} alt="" /> : <span className="mlogo mlogo-fb">{t.symbol.slice(0, 2).toUpperCase()}</span>}
                  <div className="mname">
                    <div className="ms">{t.symbol}</div>
                    <div className="mc">{fmtCap(t.mcap)} mcap{t.supply ? ` · ${fmtAmt(t.supply)} supply` : ""}</div>
                  </div>
                  <div className="mflow">
                    <div className="mbar">
                      <span className="b" style={{ width: `${(t.buys / total) * 100}%` }} />
                      <span className="s" style={{ width: `${(t.sells / total) * 100}%` }} />
                    </div>
                    <div className="mst"><span className="buy">{t.buys}▲</span> <span className="sell">{t.sells}▼</span> · {t.count} trades</div>
                  </div>
                  <span className="mpick">{sel ? (picked.indexOf(t.symbol) === 0 ? "① left" : "② right") : ""}</span>
                </button>
              );
            })}
          </div>
          <div className="pager">
            <button disabled={pg <= 0} onClick={() => setPage(pg - 1)}>← prev</button>
            <span>page {pg + 1} / {pages} · {roster.length} trading</span>
            <button disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>next →</button>
          </div>
        </>
      )}

      <div className="s-foot">
        <button className="enter" disabled={picked.length < 2} onClick={() => onStart(bySym(picked[0]), bySym(picked[1]))}>
          {picked.length < 2 ? `pick ${2 - picked.length} more` : `⚔ ${picked[0]}  vs  ${picked[1]}`}
        </button>
        <div className="hint">no token · pure spectacle · by jumpbox</div>
      </div>
    </div>
  );
}

/* ---------------- fight screen ---------------- */

function Fight({ left, right, onExit }: { left: Fighter; right: Fighter; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const stateRef = useRef<MatchState | null>(null);
  const queue = useRef<FlowEvent[]>([]);
  const cursor = useRef<string | undefined>(undefined);
  const flow = useRef<{ side: "left" | "right"; buy: boolean; amount: number; id: number }[]>([]);
  const flowId = useRef(0);
  const commentator = useRef(new Commentator());
  const mutedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
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
      arena.setFighters({ hue: hue(left.symbol), logo: left.logo }, { hue: hue(right.symbol), logo: right.logo });
      arenaRef.current = arena;
      stateRef.current = createMatch(left.symbol, right.symbol, Date.now(), { left: left.supply, right: right.supply });

      const c = commentator.current;
      const symOf = (side: "left" | "right") => (side === "left" ? left.symbol : right.symbol);
      const fire = (line: ReturnType<Commentator["say"]>) => {
        if (!line) return;
        setCallout(line);
        speak(line.text, line.intensity, mutedRef.current);
      };

      const applyEffects = (fx: ReturnType<typeof applyFlow>, now: number) => {
        for (const e of fx) {
          if (e.type === "strike") {
            arena.strike(e.side, e.blocked ? e.power * 0.35 : e.power, e.crit);
            const a = symOf(e.side), b = symOf(e.side === "left" ? "right" : "left");
            // only the notable moments get called — jabs and blocks stay silent
            if (e.crit) fire(c.say(now, "crit", { a, b }));
            else if (e.combo >= 4) fire(c.say(now, "combo", { n: e.combo + 1, a, b }));
            else if (e.power > 2.6) fire(c.say(now, "bigStrike", { a, b }));
          } else if (e.type === "stagger") {
            arena.stagger(e.side, 0.8);
          } else if (e.type === "expose") {
            fire(c.say(now, "expose", { who: symOf(e.side) }));
          } else if (e.type === "ko") {
            arena.ko(e.loser);
            fire(c.say(now, "ko", { who: symOf(e.loser), winner: symOf(e.loser === "left" ? "right" : "left") }));
          } else if (e.type === "roundBanner" || e.type === "matchBanner") {
            fire(c.say(now, "round", { banner: e.text }));
          }
        }
      };

      const pollFlow = async () => {
        try {
          const q = cursor.current ? `?since=${cursor.current}` : "";
          const res = await fetch(`/api/flow${q}`);
          const d = await res.json();
          if (!res.ok) return;
          cursor.current = d.latestBlock;
          for (const e of d.events as FlowEvent[]) if (e.symbol === left.symbol || e.symbol === right.symbol) queue.current.push(e);
          if (queue.current.length > 60) queue.current = queue.current.slice(-60);
        } catch {}
      };

      await pollFlow();
      poll = setInterval(pollFlow, 2500);
      drain = setInterval(() => {
        const st = stateRef.current!;
        const e = queue.current.shift();
        const now = Date.now();
        if (e && st.phase === "fight") {
          const fside: "left" | "right" = e.symbol === left.symbol ? "left" : "right";
          flow.current = [{ side: fside, buy: e.side === "buy", amount: e.amount, id: flowId.current++ }, ...flow.current].slice(0, 14);
          applyEffects(applyFlow(st, e, now), now);
        }
        repaint();
      }, 360);
      ticker = setInterval(() => {
        const st = stateRef.current!;
        const now = Date.now();
        applyEffects(tick(st, now, 100), now);
        repaint();
      }, 100);
    })();

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(drain);
      clearInterval(ticker);
      arenaRef.current?.dispose();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
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
          <h1>{left.symbol} <span className="vs">vs</span> {right.symbol}</h1>
          <div className="sub">round {st?.round ?? 1} · {timeLeft !== null ? `${timeLeft}s` : "—"} · buys strike · sells expose</div>
        </div>

        {voiceAvailable() && (
          <button className="mute" onClick={() => { const m = !muted; setMuted(m); mutedRef.current = m; if (m) window.speechSynthesis.cancel(); }}>
            {muted ? "🔇 commentary" : "🔊 commentary"}
          </button>
        )}

        <div className="fighters">
          <div className="fighter">
            <div className="fname" style={{ color: LIME }}>
              <LogoBadge f={left} />{left.symbol} <span className="pips">{pips(st?.left.roundsWon ?? 0).map((w, i) => <i key={i} className={w ? "on" : ""} />)}</span>
            </div>
            <div className="hpwrap"><div className="hp" style={{ width: pct(st?.left.hp ?? CFG.HP_MAX), background: LIME }} /></div>
            <div className="guardwrap"><div className="guard" style={{ width: `${st?.left.guard ?? 100}%` }} /></div>
            <div className="flowline">
              {flow.current.filter((x) => x.side === "left").slice(0, 5).map((x) => (
                <span key={x.id} className={x.buy ? "fb" : "fs"}>{x.buy ? "▲" : "▼"}{fmtAmt(x.amount)}</span>
              ))}
            </div>
            {(st?.left.combo ?? 0) >= 2 && <div className="combo" style={{ color: LIME }}>combo ×{st!.left.combo + 1}</div>}
          </div>
          <div className="fighter r">
            <div className="fname" style={{ color: RED }}>
              <span className="pips r">{pips(st?.right.roundsWon ?? 0).map((w, i) => <i key={i} className={w ? "on" : ""} />)}</span> {right.symbol}<LogoBadge f={right} />
            </div>
            <div className="hpwrap"><div className="hp r" style={{ width: pct(st?.right.hp ?? CFG.HP_MAX), background: RED, marginLeft: "auto" }} /></div>
            <div className="guardwrap"><div className="guard r" style={{ width: `${st?.right.guard ?? 100}%`, marginLeft: "auto" }} /></div>
            <div className="flowline r">
              {flow.current.filter((x) => x.side === "right").slice(0, 5).map((x) => (
                <span key={x.id} className={x.buy ? "fb" : "fs"}>{x.buy ? "▲" : "▼"}{fmtAmt(x.amount)}</span>
              ))}
            </div>
            {(st?.right.combo ?? 0) >= 2 && <div className="combo r" style={{ color: RED }}>combo ×{st!.right.combo + 1}</div>}
          </div>
        </div>

        {callout && <div className={`callout ${callout.intensity}`} key={callout.id}>{callout.text}</div>}
        <div className={`round ${st?.banner ? "show" : ""}`}>{st?.banner}</div>

        {st?.phase === "matchEnd" && (
          <div className="endbtns"><button onClick={onExit}>← new match</button></div>
        )}
        <div className="foot">live on Robinhood Chain · by jumpbox</div>
      </div>
    </>
  );
}
