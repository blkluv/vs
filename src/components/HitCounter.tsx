"use client";

import { useEffect, useState } from "react";

type Counts = { visitors: number | null; fights: number | null };

function visitorId(): string {
  try {
    let v = localStorage.getItem("pit_vid");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("pit_vid", v);
    }
    return v;
  } catch {
    return "anon";
  }
}

/** Fire-and-forget: count a fight when a match starts. */
export function bumpFights() {
  fetch("/api/hits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "fight" }) }).catch(() => {});
}

export function HitCounter() {
  const [c, setC] = useState<Counts | null>(null);

  useEffect(() => {
    fetch("/api/hits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "visit", id: visitorId() }),
    })
      .then((r) => r.json())
      .then(setC)
      .catch(() => {});
  }, []);

  if (!c || c.visitors == null) return null; // store not configured -> hide

  return (
    <div className="hitcounter">
      <span className="hc-n">{c.visitors.toLocaleString()}</span> in the pit
      {c.fights != null && (
        <>
          {" · "}
          <span className="hc-n">{c.fights.toLocaleString()}</span> fights
        </>
      )}
    </div>
  );
}
