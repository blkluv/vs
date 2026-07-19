import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Same-origin image proxy so token logos can be used as WebGL textures on the
// fighters (cross-origin images taint the canvas). Allowlisted hosts only.
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)?(dexscreener\.com|geckoterminal\.com|coingecko\.com)\//i;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!ALLOWED.test(url)) {
    return NextResponse.json({ error: "url not allowed" }, { status: 400 });
  }
  try {
    const r = await fetch(url, { headers: { "user-agent": "pit/1.0 (+jumpbox.tech)" } });
    if (!r.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "content-type": r.headers.get("content-type") || "image/png",
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
